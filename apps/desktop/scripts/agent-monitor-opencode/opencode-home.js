/**
 * @file opencode-home.js
 * @description Centralized OpenCode session path management. Resolves paths
 * for OpenCode's data directory which contains:
 *
 * 1. opencode.db — SQLite master index tracking sessions and project mappings
 * 2. storage/ — per-session subdirectories with individual message JSON files
 * 3. log/ — timestamped debug log files
 *
 * Supports custom root via the OPENCODE_DATA_DIR environment variable.
 */
const path = require("path");
const os = require("os");
const fs = require("fs");

function getOpenCodeHome() {
  const raw = process.env.OPENCODE_DATA_DIR;
  if (raw && raw.trim()) {
    return raw.trim().replace(/^~(?=\/)/, os.homedir());
  }
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "opencode");
  }
  return path.join(home, ".local", "share", "opencode");
}

function getOpenCodeStorageDir() {
  return path.join(getOpenCodeHome(), "storage");
}

function getOpenCodeDbPath() {
  return path.join(getOpenCodeHome(), "opencode.db");
}

/**
 * Discover all session directories under the storage root.
 * Each session directory contains individual message JSON files.
 * Returns array of { sessionDir, sessionId }.
 */
function listSessionDirs() {
  const storageDir = getOpenCodeStorageDir();
  if (!fs.existsSync(storageDir)) return [];
  const results = [];

  let entries;
  try { entries = fs.readdirSync(storageDir, { withFileTypes: true }); } catch { return []; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionDir = path.join(storageDir, entry.name);
    // Check that it contains at least one JSON file (it's a real session)
    let files;
    try { files = fs.readdirSync(sessionDir); } catch { continue; }
    const hasJson = files.some((f) => f.endsWith(".json"));
    if (hasJson) {
      results.push({ sessionDir, sessionId: entry.name });
    }
  }
  return results;
}

/**
 * Collect all message JSON files in a session directory, sorted by name
 * (message_1.json, message_2.json, etc.).
 */
function collectMessageFiles(sessionDir) {
  if (!fs.existsSync(sessionDir)) return [];
  let files;
  try { files = fs.readdirSync(sessionDir); } catch { return []; }
  return files
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => {
      // Sort by numeric index if present (message_1.json before message_2.json)
      const numA = parseInt(a.match(/(\d+)/)?.[1] || "0", 10);
      const numB = parseInt(b.match(/(\d+)/)?.[1] || "0", 10);
      return numA - numB;
    })
    .map((f) => path.join(sessionDir, f));
}

module.exports = {
  getOpenCodeHome,
  getOpenCodeStorageDir,
  getOpenCodeDbPath,
  listSessionDirs,
  collectMessageFiles,
};
