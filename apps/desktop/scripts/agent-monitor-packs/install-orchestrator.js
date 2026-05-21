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
const fs = require("fs");
const path = require("path");
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
function buildAllowedChildEnv(parentEnv = process.env, cwd = null) {
  const allowed = [
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
  for (const key of allowed) {
    if (typeof parentEnv[key] === "string" && parentEnv[key].length > 0) {
      out[key] = parentEnv[key];
    }
  }
  if (!out.HOME) out.HOME = require("os").homedir();
  if (cwd) {
    out.INIT_CWD = cwd;
    out.PWD = cwd;
  }
  return out;
}

/**
 * Heuristic for catalog commands that operate on the current directory and
 * must NOT be run without an explicit, validated project cwd. Tightened in
 * v0.15.54 — the original ` ./` pattern produced a false positive on commands
 * like `cd ~/.claude/skills/gstack && ./setup` where the `./` is preceded by
 * a `cd` to an ABSOLUTE path (the script then executes at that absolute
 * location; not project-relative in the sense that matters here).
 *
 * Now we only match the unambiguous "writes to cwd" signals:
 *   --directory .   (npx-style)
 *   --directory=.   (gnu-arg-style)
 *    -C .           (make / git -C style)
 *
 * The explicit `project_scoped: true` flag on the catalog seed is the
 * canonical signal. This heuristic only acts as defense-in-depth for entries
 * that forgot to set the flag.
 */
const PROJECT_RELATIVE_HINTS = ["--directory .", "--directory=.", " -C ."];
function looksProjectRelative(command) {
  if (typeof command !== "string") return false;
  return PROJECT_RELATIVE_HINTS.some((hint) => command.includes(hint));
}

/**
 * Probe whether a harness CLI is installed on PATH. Used by `single_install`
 * packs (gstack today) so we install only for the harnesses the user actually
 * has. Best-effort and short-timeout — never blocks the request long.
 *
 * @param {string} harness — 'claude' | 'codex' (extend as we add more)
 * @returns {boolean}
 */
const HARNESS_CLI_BINARIES = {
  claude: "claude",
  codex: "codex",
};
function isHarnessInstalled(harness) {
  const bin = HARNESS_CLI_BINARIES[harness];
  if (!bin) return false;
  try {
    const out = require("child_process").execFileSync("/usr/bin/which", [bin], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    });
    return Boolean(out.toString().trim());
  } catch {
    return false;
  }
}

function joinIndependentCleanupCommands(commands) {
  const failureVar = "__closedloop_uninstall_failed";
  return [
    `${failureVar}=0`,
    ...commands.map((command) => `if ! ( ${command} ); then ${failureVar}=1; fi`),
    `exit $${failureVar}`,
  ].join("; ");
}

/**
 * For `single_install` packs (gstack), pick the command to run for install
 * or uninstall. Install and uninstall use different join strategies because
 * the underlying commands have different semantic relationships:
 *
 *   INSTALL — pick the SUPERSET command. By convention for single_install
 *   packs, the codex install command is a superset of the claude install
 *   command (gstack's `./setup && ./setup --host codex` runs the claude
 *   setup AND the codex one). Running the superset alone installs for all
 *   detected CLIs.
 *
 *   UNINSTALL — run all uninstall commands across listed harnesses
 *   independently, but aggregate failures. The claude and codex uninstall
 *   commands are DISJOINT cleanups
 *   (claude: rm ~/.claude/skills/gstack; codex: rm ~/.codex/skills/gstack*),
 *   neither is a superset of the other. Running only one leaves the other
 *   harness's artifacts on disk. We still avoid `&&` so each step is
 *   independent — a missing artifact in one harness doesn't skip cleanup in
 *   the next — but any non-zero step still makes the overall uninstall fail.
 *   Uninstall runs for ALL listed harnesses (not just CLIs currently on
 *   PATH) because on-disk artifacts may outlive the CLI install.
 *
 * Returns { command, registerHarnesses }.
 */
function pickSingleInstallCommand(entry, action) {
  const cmdMap =
    action === "uninstall" ? entry.uninstall_commands : entry.install_commands;
  const harnesses = Array.isArray(entry.harnesses) ? entry.harnesses : [];

  if (action === "uninstall") {
    // Run ALL listed harnesses' uninstall commands. Keep each cleanup
    // independent, but surface any failure in the aggregate exit status.
    // Run regardless of which CLIs are currently on PATH — we're cleaning
    // up artifacts, not managing live CLIs.
    const cmds = harnesses
      .map((h) => cmdMap && cmdMap[h])
      .filter(Boolean);
    if (cmds.length === 0) {
      return { command: null, registerHarnesses: [] };
    }
    return {
      command: joinIndependentCleanupCommands(cmds),
      registerHarnesses: harnesses,
    };
  }

  // Install path — only consider harnesses whose CLI is actually present.
  const installed = harnesses.filter(isHarnessInstalled);
  if (installed.length === 0) {
    return { command: null, registerHarnesses: [] };
  }
  // Prefer codex command when codex is present and there's a command for it,
  // since the convention is codex command = claude command + extras. If no
  // codex command exists, fall back to claude.
  const codexFirst = ["codex", "claude"];
  for (const h of codexFirst) {
    if (installed.includes(h) && cmdMap && cmdMap[h]) {
      return { command: cmdMap[h], registerHarnesses: installed };
    }
  }
  // Last resort: any command, any installed harness.
  for (const h of installed) {
    if (cmdMap && cmdMap[h]) {
      return { command: cmdMap[h], registerHarnesses: installed };
    }
  }
  return { command: null, registerHarnesses: [] };
}

// Strip ANSI escape sequences for stored tails. The live SSE stream keeps the
// raw bytes so terminal-styled output still renders for the user.
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
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

function resolveSpawnCwd(requestedCwd) {
  if (typeof requestedCwd !== "string" || requestedCwd.trim().length === 0) {
    return null;
  }

  const trimmed = requestedCwd.trim();
  if (!path.isAbsolute(trimmed)) {
    const err = new Error("cwd must be an absolute path");
    err.code = "EBADCWD";
    throw err;
  }

  const abs = path.resolve(trimmed);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    const err = new Error(`cwd does not exist: ${abs}`);
    err.code = "EBADCWD";
    throw err;
  }
  if (!stat.isDirectory()) {
    const err = new Error(`not a directory: ${abs}`);
    err.code = "EBADCWD";
    throw err;
  }
  if (abs === "/" || abs === path.parse(abs).root) {
    const err = new Error("refusing to spawn at filesystem root");
    err.code = "EBADCWD";
    throw err;
  }
  return abs;
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
  const requestedCwd = typeof opts.cwd === "string" ? opts.cwd.trim() : "";

  if (!res.headersSent) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
  }

  const entry = getCatalog(db, pack_id);
  if (!entry) {
    sse(res, "error", { message: `pack_id not in catalog: ${pack_id}` });
    sse(res, "complete", { exit_code: -1, reason: "not_found" });
    res.end();
    return;
  }
  // For `single_install` packs (gstack), the catalog UI sends harness="auto"
  // and we pick the command that covers all installed CLIs in one run.
  // Otherwise the per-harness command from the seed is used as-is.
  let command;
  let resolvedHarnesses = [harness];
  if (entry.single_install === 1 && harness === "auto") {
    const picked = pickSingleInstallCommand(entry, action);
    command = picked.command;
    resolvedHarnesses = picked.registerHarnesses;
    if (!command) {
      const noCommandMessage =
        action === "uninstall"
          ? `pack '${pack_id}' is single_install but no uninstall commands are configured for any listed harness.`
          : `pack '${pack_id}' is single_install but no supported CLI is on PATH. ` +
            `Install Claude Code or Codex first, then try again.`;
      sse(res, "error", {
        message: noCommandMessage,
      });
      sse(res, "complete", {
        exit_code: -1,
        reason: action === "uninstall" ? "no_command" : "no_cli_detected",
      });
      res.end();
      return;
    }
  } else {
    const commandMap =
      action === "uninstall"
        ? entry.uninstall_commands
        : entry.install_commands;
    command = commandMap && commandMap[harness];
    if (!command) {
      sse(res, "error", {
        message: `no ${action} command for harness '${harness}' on pack '${pack_id}'`,
      });
      sse(res, "complete", { exit_code: -1, reason: "no_command" });
      res.end();
      return;
    }
  }

  let resolvedCwd = null;
  try {
    resolvedCwd = resolveSpawnCwd(requestedCwd);
  } catch (error) {
    sse(res, "error", {
      code: error && error.code ? error.code : "EBADCWD",
      message: error && error.message ? error.message : "invalid cwd",
    });
    sse(res, "complete", { exit_code: -1, reason: "invalid_cwd" });
    res.end();
    return;
  }

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

  const requiresProjectCwd =
    entry.project_scoped === true ||
    entry.project_scoped === 1 ||
    looksProjectRelative(command);
  if (requiresProjectCwd && !resolvedCwd) {
    sse(res, "copy_command", {
      pack_id,
      command,
      reason:
        entry.project_scoped === true || entry.project_scoped === 1
          ? "project_scoped"
          : "looks_project_relative",
    });
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

  const runId = recordInstallRunStart(db, { pack_id, harness, command });
  sse(res, "start", { run_id: runId, command, cwd: resolvedCwd });

  let stdoutBuf = "";
  let stderrBuf = "";
  let killed = false;

  const spawnOpts = {
    stdio: ["ignore", "pipe", "pipe"],
    env: buildAllowedChildEnv(process.env, resolvedCwd),
  };
  if (resolvedCwd) spawnOpts.cwd = resolvedCwd;
  const child = spawn("sh", ["-c", command], spawnOpts);

  const timer = setTimeout(() => {
    killed = true;
    sse(
      res,
      "stderr",
      `[install-orchestrator] timeout after ${timeoutMs}ms — killing\n`,
    );
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
    // On successful install only: surface the pack's post_install block (if
    // present) BEFORE the complete event, so the client knows to render the
    // "next steps" screen instead of plain Done. (User-facing: this is what
    // pops the CCR provider-keys reminder, etc.)
    if (
      !killed &&
      exitCode === 0 &&
      action === "install" &&
      entry.post_install
    ) {
      sse(res, "post_install", entry.post_install);
    }
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

  res.on("close", () => {
    if (!res.writableEnded) {
      res.end = () => {};
      res.write = () => {};
    }
  });
}

module.exports = {
  streamRun,
  _internals: {
    buildAllowedChildEnv,
    looksProjectRelative,
    resolveSpawnCwd,
    stripAnsi,
    tailBytes,
    isHarnessInstalled,
    joinIndependentCleanupCommands,
    pickSingleInstallCommand,
  },
};
