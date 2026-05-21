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
const path = require("path");
const fs = require("fs");
const {
  getCatalog,
  recordInstallRunStart,
  recordInstallRunEnd,
  inFlightInstallRun,
} = require("./catalog-store");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const TAIL_BYTES = 4096;

/**
 * Minimal env passed to child install processes.
 *
 * SHIPPED FIX (shafty PR review P1): the previous `env: process.env` passed
 * the FULL Desktop process environment to arbitrary catalog shell commands,
 * which can include ClosedLoop tokens, PostHog keys, API keys, and shell
 * credentials. A malicious or compromised catalog entry could exfiltrate
 * any of them. Only an allowlist of variables needed for sane CLI execution
 * (PATH for binary lookup, HOME / USER for ~/ expansion, LANG / TERM for
 * proper rendering, SHELL for `sh -c`) is passed through.
 */
function buildAllowedChildEnv() {
  const ALLOWED = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TMPDIR",
    "HOMEBREW_PREFIX",
    "HOMEBREW_CELLAR",
    "HOMEBREW_REPOSITORY",
    "PYTHONUNBUFFERED",
  ];
  const out = {};
  for (const k of ALLOWED) {
    if (process.env[k] != null) out[k] = process.env[k];
  }
  // Force a sensible HOME if process.env.HOME isn't set (defense-in-depth;
  // npm and brew both refuse to run without one).
  if (!out.HOME) out.HOME = require("os").homedir();
  return out;
}

/** Heuristics for catalog commands that operate on the current directory and
 *  must NOT be run without an explicit, validated project cwd. shafty PR
 *  review P1: BMad's `npx bmad-method install --directory .` would write
 *  files into whatever directory launched the sidecar (typically the user's
 *  home or the build dir), not the project they intended. We refuse to spawn
 *  these unless the caller passes an explicit cwd. */
const PROJECT_RELATIVE_HINTS = [
  "--directory .",
  "--directory=.",
  " -C .",
  " ./",
];
function looksProjectRelative(command) {
  if (typeof command !== "string") return false;
  return PROJECT_RELATIVE_HINTS.some((h) => command.includes(h));
}

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
  // Optional `cwd` from the request — only honored if it resolves to an
  // existing directory and is not blacklisted (no /etc, /, etc.). The
  // catalog-route layer is responsible for validating that this is a path
  // the user explicitly approved.
  const requestedCwd = typeof opts.cwd === "string" ? opts.cwd.trim() : "";

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

  // Validate cwd if provided. Refuses project-relative commands (BMad's
  // `--directory .`) without a validated cwd. (shafty PR review P1.)
  let resolvedCwd = null;
  if (requestedCwd) {
    try {
      const abs = path.resolve(requestedCwd);
      const stat = fs.statSync(abs);
      if (!stat.isDirectory()) {
        throw new Error(`not a directory: ${abs}`);
      }
      // Reject obviously-dangerous roots.
      if (abs === "/" || abs === path.parse(abs).root) {
        throw new Error("refusing to spawn at filesystem root");
      }
      resolvedCwd = abs;
    } catch (e) {
      sse(res, "error", {
        message: `invalid cwd '${requestedCwd}': ${e.message}`,
      });
      sse(res, "complete", { exit_code: -1, reason: "invalid_cwd" });
      res.end();
      return;
    }
  }
  if (
    (entry.project_scoped === true || looksProjectRelative(command)) &&
    !resolvedCwd
  ) {
    sse(res, "error", {
      message:
        `pack '${pack_id}' is project-scoped (command operates on cwd). ` +
        `Provide an explicit \`cwd\` for the install — otherwise it would ` +
        `run in the sidecar's launch directory, not your project.`,
    });
    sse(res, "complete", { exit_code: -1, reason: "cwd_required" });
    res.end();
    return;
  }

  // Record start
  const runId = recordInstallRunStart(db, { pack_id, harness, command });
  sse(res, "start", { run_id: runId, command, cwd: resolvedCwd });

  let stdoutBuf = "";
  let stderrBuf = "";
  let killed = false;

  const spawnOpts = {
    stdio: ["ignore", "pipe", "pipe"],
    env: buildAllowedChildEnv(),
  };
  if (resolvedCwd) spawnOpts.cwd = resolvedCwd;
  const child = spawn("sh", ["-c", command], spawnOpts);

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
  _internals: {
    stripAnsi,
    tailBytes,
    buildAllowedChildEnv,
    looksProjectRelative,
  },
};
