import { app } from "electron";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { gatewayLog } from "./gateway-logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAG = "agent-monitor-path";

export interface AgentMonitorPaths {
  // Directory containing server/, client/dist/, scripts/, package.json.
  rootDir: string;
  // The Node CLI entry to spawn (the Express server).
  entryFile: string;
  // Directory holding install-hooks.js / hook-handler.js / uninstall-hooks.js.
  scriptsDir: string;
}

// Packaged builds read from the unpacked extraResources copy. Development
// builds read from the generated runtime tree that build-agent-monitor.mjs
// materializes from the pnpm-managed upstream packages.
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
    path.join(cwd, ".generated", "agent-monitor"), // launched from apps/desktop
    path.join(cwd, "apps", "desktop", ".generated", "agent-monitor"), // repo root
    path.join(__dirname, "..", "..", ".generated", "agent-monitor"), // dist/main -> app
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "server", "index.js"))) {
      return candidate;
    }
  }
  gatewayLog.warn(
    TAG,
    `unable to validate generated runtime tree; defaulting to ${candidates[0]}`,
  );
  return candidates[0];
}
