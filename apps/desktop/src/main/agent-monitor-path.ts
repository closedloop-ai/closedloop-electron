import { app } from "electron";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { gatewayLog } from "./gateway-logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAG = "agent-monitor-path";

export interface AgentMonitorPaths {
  /** Directory containing server/, client/dist/, scripts/, package.json. */
  rootDir: string;
  /** The Node CLI entry to spawn (the Express server). */
  entryFile: string;
  /** Directory holding install-hooks.js / hook-handler.js / uninstall-hooks.js. */
  scriptsDir: string;
}

export interface AgentMonitorHookPaths {
  /** Directory holding the first-party hook-handler.js + codex-hook-handler.js. */
  hooksDir: string;
}

/**
 * Resolve the generated legacy sidecar runtime tree. Packaged builds read the
 * unpacked `extraResources/agent-monitor` copy; development builds read the
 * tree materialized by scripts/build-agent-monitor.mjs.
 */
export function resolveAgentMonitorPaths(): AgentMonitorPaths {
  const rootDir = resolveRootDir();
  return {
    rootDir,
    entryFile: path.join(rootDir, "server", "index.js"),
    scriptsDir: path.join(rootDir, "scripts"),
  };
}

/**
 * Resolve the directory holding the first-party hook handler scripts (FEA-1503).
 * Packaged builds read the unpacked `extraResources/hooks` copy; development
 * builds read them from `apps/desktop/resources/hooks`. The handlers are copied
 * into userData at install time by `agent-monitor-hooks.ts`, so the installed hook
 * command is independent of the .app location.
 */
export function resolveAgentMonitorHookPaths(): AgentMonitorHookPaths {
  return { hooksDir: resolveHooksDir() };
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

function resolveHooksDir(): string {
  if (app.isPackaged) {
    // electron-builder.yml extraResources: `to: hooks`.
    return path.join(process.resourcesPath, "hooks");
  }

  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "resources", "hooks"), // launched from apps/desktop
    path.join(cwd, "apps", "desktop", "resources", "hooks"), // repo root
    path.join(__dirname, "..", "..", "resources", "hooks"), // dist/main -> app
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "hook-handler.js"))) {
      return candidate;
    }
  }
  gatewayLog.warn(
    TAG,
    `unable to locate hook handler scripts; defaulting to ${candidates[0]}`,
  );
  return candidates[0];
}
