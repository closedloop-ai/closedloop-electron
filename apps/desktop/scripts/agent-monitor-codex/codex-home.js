/**
 * @file codex-home.js
 * @description Centralized OpenAI Codex CLI home directory path management —
 * the Codex analogue of claude-home.js. Resolves the sessions root, the
 * rollout JSONL files (Codex writes one append-only `rollout-*.jsonl` per
 * session under `sessions/YYYY/MM/DD/`), the aggregated history file, and the
 * archived-sessions directory. Supports a custom root via the CODEX_HOME
 * environment variable so non-default Codex installs are still discovered.
 *
 * Part of CLOSEDLOOP VENDOR Addition #6 (see vendor/agent-monitor/VENDOR.md).
 */
const path = require("path");
const os = require("os");
const fs = require("fs");

function getCodexHome() {
  // Codex accepts a comma-separated CODEX_HOME in some setups; the first entry
  // is the active root. Fall back to ~/.codex.
  const raw = process.env.CODEX_HOME;
  if (raw && raw.trim()) {
    const first = raw.split(",")[0].trim();
    if (first) return first.replace(/^~(?=\/)/, os.homedir());
  }
  return path.join(os.homedir(), ".codex");
}

function getCodexSessionsDir() {
  return path.join(getCodexHome(), "sessions");
}

function getCodexArchivedDir() {
  return path.join(getCodexHome(), "archived_sessions");
}

function getCodexHistoryPath() {
  return path.join(getCodexHome(), "history.jsonl");
}

/**
 * Derive a stable session id from a rollout file path. Codex names rollout
 * files `rollout-<ISO8601>-<uuid>.jsonl`; we want the uuid. If the name
 * doesn't match, fall back to the basename sans extension so every file still
 * maps to a deterministic id.
 */
function sessionIdFromRolloutPath(filePath) {
  const base = path.basename(filePath, ".jsonl");
  const uuid = base.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  if (uuid) return uuid[0];
  return base.replace(/^rollout-/, "");
}

/**
 * Recursively collect every `*.jsonl` rollout file under a root directory.
 * Codex nests by date (`sessions/YYYY/MM/DD/`), but we walk generically so a
 * flat layout or `archived_sessions/` also works. Depth-bounded and
 * error-tolerant — a Codex dir is the user's own local data and a permission
 * or IO error on one branch must not abort discovery.
 */
function collectRolloutFiles(root, { maxDepth = 8 } = {}) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  };
  walk(root, 0);
  return out;
}

/**
 * All Codex rollout files (active sessions + archived).
 */
function listAllRolloutFiles() {
  return [
    ...collectRolloutFiles(getCodexSessionsDir()),
    ...collectRolloutFiles(getCodexArchivedDir()),
  ];
}

module.exports = {
  getCodexHome,
  getCodexSessionsDir,
  getCodexArchivedDir,
  getCodexHistoryPath,
  sessionIdFromRolloutPath,
  collectRolloutFiles,
  listAllRolloutFiles,
};
