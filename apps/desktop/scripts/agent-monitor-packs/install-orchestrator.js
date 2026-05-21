/**
 * @file install-orchestrator.js
 * @description Spawns the install / uninstall subprocess for a catalog pack
 * and streams its output to the client via SSE (FEA-1314 / PLN-657). Every
 * run is recorded in `pack_install_runs` for audit. After a successful
 * install/uninstall, runPackScanner is called so the installed badge flips
 * without manual refresh.
 *
 * Safeguards:
 *  - Hard timeout (default 10 min) — subprocess killed if it overruns
 *  - Concurrent-install guard: refuses if a run for the same pack is still
 *    in-flight (`SELECT WHERE ended_at IS NULL`)
 *  - ANSI escape codes stripped from stored tails (full output stays in the
 *    live SSE stream)
 */
"use strict";

const { spawn } = require("child_process");
const {
  getCatalog,
  recordInstallRunStart,
  recordInstallRunEnd,
  inFlightInstallRun,
} = require("./catalog-store");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const TAIL_BYTES = 4096;

// Strip ANSI escape sequences for stored tails. The live SSE stream keeps the
// raw bytes so terminal-styled output still renders for the user.
const ANSI_RE = /\[[0-9;?]*[ -/]*[@-~]/g;
function stripAnsi(s) {
  return typeof s === "string" ? s.replace(ANSI_RE, "") : s;
}

function tailBytes(buffer) {
  if (!buffer) return null;
  const stripped = stripAnsi(buffer);
  if (stripped.length <= TAIL_BYTES) return stripped;
  return "…" + stripped.slice(stripped.length - TAIL_BYTES);
}

function sse(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

/**
 * Run an install (or uninstall) command for a catalog pack and stream output
 * to `res` over SSE.
 *
 * @param {object} db                        — DB handle
 * @param {object} opts
 * @param {string} opts.pack_id              — must exist in pack_catalog
 * @param {string} opts.harness              — claude | codex | ...
 * @param {'install'|'uninstall'} opts.action
 * @param {object} opts.res                  — Express response (SSE)
 * @param {() => void} [opts.onComplete]     — called after run finalizes
 *                                              (e.g. to trigger runPackScanner)
 * @param {number} [opts.timeoutMs]
 */
function streamRun(db, opts) {
  const { pack_id, harness, action, res, onComplete } = opts;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  // Set SSE headers (only if not already set)
  if (!res.headersSent) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
  }

  // Lookup catalog entry
  const entry = getCatalog(db, pack_id);
  if (!entry) {
    sse(res, "error", { message: `pack_id not in catalog: ${pack_id}` });
    sse(res, "complete", { exit_code: -1, reason: "not_found" });
    res.end();
    return;
  }
  const commandMap =
    action === "uninstall" ? entry.uninstall_commands : entry.install_commands;
  const command = commandMap && commandMap[harness];
  if (!command) {
    sse(res, "error", {
      message: `no ${action} command for harness '${harness}' on pack '${pack_id}'`,
    });
    sse(res, "complete", { exit_code: -1, reason: "no_command" });
    res.end();
    return;
  }

  // Concurrent-install guard
  const inFlight = inFlightInstallRun(db, pack_id);
  if (inFlight) {
    sse(res, "error", {
      message: `another run for ${pack_id} is already in-flight (started ${inFlight.started_at})`,
      in_flight_run_id: inFlight.id,
    });
    sse(res, "complete", { exit_code: -1, reason: "in_flight" });
    res.end();
    return;
  }

  // Record start
  const runId = recordInstallRunStart(db, { pack_id, harness, command });
  sse(res, "start", { run_id: runId, command });

  let stdoutBuf = "";
  let stderrBuf = "";
  let killed = false;

  const child = spawn("sh", ["-c", command], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const timer = setTimeout(() => {
    killed = true;
    sse(res, "stderr", `[install-orchestrator] timeout after ${timeoutMs}ms — killing\n`);
    try {
      child.kill("SIGTERM");
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }, 2000);
    } catch {
      /* already dead */
    }
  }, timeoutMs);

  child.stdout.on("data", (chunk) => {
    const s = chunk.toString("utf8");
    stdoutBuf += s;
    sse(res, "stdout", s);
  });
  child.stderr.on("data", (chunk) => {
    const s = chunk.toString("utf8");
    stderrBuf += s;
    sse(res, "stderr", s);
  });
  child.on("error", (err) => {
    sse(res, "stderr", `[install-orchestrator] spawn error: ${err.message}\n`);
  });

  child.on("close", (code, signal) => {
    clearTimeout(timer);
    const exitCode = code != null ? code : signal ? -1 : -1;
    recordInstallRunEnd(db, runId, {
      exit_code: killed ? -1 : exitCode,
      stdout_tail: tailBytes(stdoutBuf),
      stderr_tail: tailBytes(stderrBuf),
    });
    sse(res, "complete", {
      exit_code: killed ? -1 : exitCode,
      reason: killed ? "timeout" : signal ? `signal:${signal}` : "exit",
      run_id: runId,
    });
    res.end();
    if (typeof onComplete === "function") {
      try {
        onComplete({ exit_code: exitCode, killed });
      } catch (e) {
        console.warn(
          "[install-orchestrator] onComplete callback failed:",
          e && e.message,
        );
      }
    }
  });

  // Client disconnect: leave subprocess running but stop streaming. The run
  // record will still be finalized on child close.
  res.on("close", () => {
    if (!res.writableEnded) {
      // client gone — silence further writes
      res.end = () => {};
      res.write = () => {};
    }
  });
}

module.exports = {
  streamRun,
  // Exported for tests
  _internals: { stripAnsi, tailBytes },
};
