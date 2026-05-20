/**
 * @file cursor-home.js
 * @description Centralized Cursor session path management. Resolves paths for
 * Cursor's background agent JSONL transcripts stored under
 * `~/.cursor/projects/<project-id>/agent-transcripts/<session-id>/`.
 *
 * Cursor also stores standard chat sessions in a SQLite database
 * (`state.vscdb`) under VS Code workspace storage, but those are opaque
 * key-value blobs — this module focuses on the structured agent transcripts
 * that yield the same telemetry the dashboard expects.
 */
const path = require("path");
const os = require("os");
const fs = require("fs");

function getCursorHome() {
  const raw = process.env.CURSOR_HOME;
  if (raw && raw.trim()) {
    return raw.trim().replace(/^~(?=\/)/, os.homedir());
  }
  return path.join(os.homedir(), ".cursor");
}

function getCursorProjectsDir() {
  return path.join(getCursorHome(), "projects");
}

/**
 * Derive a stable session id from an agent transcript path.
 * Cursor stores transcripts at:
 *   ~/.cursor/projects/<project-id>/agent-transcripts/<session-id>/<session-id>.jsonl
 * The session-id directory name is the canonical id.
 */
function sessionIdFromTranscriptPath(filePath) {
  // The parent directory name is the session id
  return path.basename(path.dirname(filePath));
}

/**
 * Recursively collect every `*.jsonl` transcript file under the projects root.
 * Cursor nests by project → agent-transcripts → session-id, but we walk
 * generically. Depth-bounded and error-tolerant.
 */
function collectTranscriptFiles(root, { maxDepth = 8 } = {}) {
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
 * All Cursor agent transcript files.
 */
function listAllTranscriptFiles() {
  return collectTranscriptFiles(getCursorProjectsDir());
}

module.exports = {
  getCursorHome,
  getCursorProjectsDir,
  sessionIdFromTranscriptPath,
  collectTranscriptFiles,
  listAllTranscriptFiles,
};
