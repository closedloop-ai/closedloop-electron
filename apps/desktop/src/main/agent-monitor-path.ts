import { app } from "electron";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AgentMonitorPaths {
  // Directory containing server/, client/dist/, scripts/, node_modules/, package.json.
  rootDir: string;
  // The Node CLI entry to spawn (the Express server).
  entryFile: string;
  // Directory holding install-hooks.js / hook-handler.js / uninstall-hooks.js.
  scriptsDir: string;
}

// Mirrors session-dashboard-path.ts — packaged reads from the unpacked
// extraResources copy; dev resolves the vendored source tree. The entry is
// the Express server (server/index.js), not a bin/cli (this project has none).
export function resolveAgentMonitorPaths(): AgentMonitorPaths {
  const rootDir = resolveRootDir();
  return {
    rootDir,
    entryFile: path.join(rootDir, "server", "index.js"),
    scriptsDir: path.join(rootDir, "scripts"),
  };
}

function resolveRootDir(): string {
  if (app.isPackaged) {
    // electron-builder.yml extraResources: `to: agent-monitor`.
    return path.join(process.resourcesPath, "agent-monitor");
  }

  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "vendor", "agent-monitor"), // launched from repo root
    path.join(cwd, "..", "..", "vendor", "agent-monitor"), // from apps/desktop
    path.join(__dirname, "..", "..", "..", "..", "vendor", "agent-monitor"), // dist/main -> repo
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "server", "index.js"))) {
      return candidate;
    }
  }
  return path.join(cwd, "..", "..", "vendor", "agent-monitor");
}
