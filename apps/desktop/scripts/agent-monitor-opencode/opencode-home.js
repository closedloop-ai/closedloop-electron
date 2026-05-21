/**
 * @file opencode-home.js
 * @description Centralized OpenCode data-path management. OpenCode's
 * canonical session store is the SQLite database at `opencode.db`; the
 * adjacent WAL/SHM files carry live updates while the app is running.
 *
 * Supports custom root via the OPENCODE_DATA_DIR environment variable.
 */
const path = require("path");
const os = require("os");

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

function getOpenCodeDbPath() {
  return path.join(getOpenCodeHome(), "opencode.db");
}

function getOpenCodeDbWatchDir() {
  return getOpenCodeHome();
}

function getOpenCodeDbWatchFiles() {
  return ["opencode.db", "opencode.db-wal", "opencode.db-shm"];
}

module.exports = {
  getOpenCodeHome,
  getOpenCodeDbPath,
  getOpenCodeDbWatchDir,
  getOpenCodeDbWatchFiles,
};
