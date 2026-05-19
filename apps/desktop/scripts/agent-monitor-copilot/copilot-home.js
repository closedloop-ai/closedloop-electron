/**
 * @file copilot-home.js
 * @description Centralized GitHub Copilot session path management. Resolves
 * paths for:
 *
 * 1. Copilot Chat (VS Code extension): JSON session files under
 *    ~/Library/Application Support/Code/User/workspaceStorage/<hash>/chatSessions/
 *
 * 2. Copilot CLI (`gh copilot`): JSONL event logs under
 *    ~/.copilot/session-state/<session-id>/events.jsonl
 *
 * Both locations are scanned opportunistically — if neither exists the tool
 * is simply not installed or hasn't been used.
 */
const path = require("path");
const os = require("os");
const fs = require("fs");

function getCopilotCliHome() {
  const raw = process.env.COPILOT_HOME;
  if (raw && raw.trim()) {
    return raw.trim().replace(/^~(?=\/)/, os.homedir());
  }
  return path.join(os.homedir(), ".copilot");
}

function getCopilotCliSessionStateDir() {
  return path.join(getCopilotCliHome(), "session-state");
}

/**
 * VS Code workspace storage root. Platform-dependent.
 */
function getVscodeWorkspaceStorageDir() {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "Code", "User", "workspaceStorage");
    case "win32":
      return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"),
        "Code", "User", "workspaceStorage");
    default: // linux
      return path.join(home, ".config", "Code", "User", "workspaceStorage");
  }
}

/**
 * Discover all chatSession JSON files across all VS Code workspaces.
 * Returns array of { filePath, workspacePath } where workspacePath is resolved
 * from the workspace.json in the hash directory.
 */
function listChatSessionFiles() {
  const wsRoot = getVscodeWorkspaceStorageDir();
  if (!fs.existsSync(wsRoot)) return [];
  const results = [];

  let hashDirs;
  try { hashDirs = fs.readdirSync(wsRoot, { withFileTypes: true }); } catch { return []; }

  for (const hashDir of hashDirs) {
    if (!hashDir.isDirectory()) continue;
    const hashPath = path.join(wsRoot, hashDir.name);
    const chatDir = path.join(hashPath, "chatSessions");
    if (!fs.existsSync(chatDir)) continue;

    // Resolve workspace path from workspace.json
    let workspacePath = null;
    try {
      const wsJson = JSON.parse(fs.readFileSync(path.join(hashPath, "workspace.json"), "utf8"));
      const folder = wsJson.folder || wsJson.workspace || "";
      if (folder) {
        workspacePath = folder.replace(/^file:\/\//, "");
      }
    } catch { /* workspace.json may not exist or be readable */ }

    let files;
    try { files = fs.readdirSync(chatDir, { withFileTypes: true }); } catch { continue; }
    for (const f of files) {
      if (f.isFile() && f.name.endsWith(".json")) {
        results.push({
          filePath: path.join(chatDir, f.name),
          workspacePath,
        });
      }
    }
  }
  return results;
}

/**
 * Collect all Copilot CLI event JSONL files under ~/.copilot/session-state/.
 */
function listCliEventFiles() {
  const root = getCopilotCliSessionStateDir();
  if (!fs.existsSync(root)) return [];
  const results = [];

  let sessionDirs;
  try { sessionDirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }

  for (const dir of sessionDirs) {
    if (!dir.isDirectory()) continue;
    const eventsFile = path.join(root, dir.name, "events.jsonl");
    if (fs.existsSync(eventsFile)) {
      results.push({ filePath: eventsFile, sessionId: dir.name });
    }
  }
  return results;
}

module.exports = {
  getCopilotCliHome,
  getCopilotCliSessionStateDir,
  getVscodeWorkspaceStorageDir,
  listChatSessionFiles,
  listCliEventFiles,
};
