import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type InstalledPluginsFile = {
  version?: number;
  plugins?: Record<string, Array<{ installPath?: string; version?: string }>>;
};

export const CLOSEDLOOP_REQUIRED_PLUGIN_IDS = [
  "bootstrap@closedloop-ai",
  "code@closedloop-ai",
  "code-review@closedloop-ai",
  "judges@closedloop-ai",
  "platform@closedloop-ai",
  "self-learning@closedloop-ai",
] as const;

export type ClosedLoopRequiredPluginId =
  (typeof CLOSEDLOOP_REQUIRED_PLUGIN_IDS)[number];

export type PluginEnabledState = boolean | "unknown";

export type ClaudePluginInventoryEntry = {
  id: string;
  version?: string;
  enabled: PluginEnabledState;
  installPath?: string;
};

export function getPluginCacheRoot(override?: string): string {
  return override ?? path.join(os.homedir(), ".claude", "plugins", "cache", "closedloop-ai");
}

export function compareSemverDescending(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (partsB[index] ?? 0) - (partsA[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function findPluginVersions(pluginDir: string): string[] {
  try {
    return readdirSync(pluginDir)
      .filter((entry) => /^\d+\.\d+\.\d+/.test(entry))
      .sort((a, b) => compareSemverDescending(a, b));
  } catch {
    return [];
  }
}

export function findPluginScript(
  pluginName: string,
  scriptName: string,
  cacheRoot?: string
): string | null {
  const pluginDir = path.join(getPluginCacheRoot(cacheRoot), pluginName);
  if (!existsSync(pluginDir)) {
    return null;
  }

  const versions = findPluginVersions(pluginDir);
  for (const version of versions) {
    const scriptPath = path.join(pluginDir, version, "scripts", scriptName);
    if (existsSync(scriptPath)) {
      return scriptPath;
    }
  }

  return null;
}

export function isPluginInstalled(pluginName: string, registryPath?: string): boolean {
  registryPath ??= path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
  try {
    const data = JSON.parse(readFileSync(registryPath, "utf-8")) as InstalledPluginsFile;
    const key = `${pluginName}@closedloop-ai`;
    const entries = data.plugins?.[key];
    if (!entries || entries.length === 0) {
      return false;
    }
    return entries.some((entry) => entry.installPath && existsSync(entry.installPath));
  } catch {
    return false;
  }
}

function readStringField(
  record: Record<string, unknown>,
  field: string
): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function parseEnabledField(value: unknown): PluginEnabledState {
  return typeof value === "boolean" ? value : "unknown";
}

function normalizePluginInventoryEntry(
  value: unknown
): ClaudePluginInventoryEntry | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = readStringField(record, "id") ?? readStringField(record, "name");
  if (!id) {
    return null;
  }

  return {
    id,
    enabled: parseEnabledField(record.enabled),
    ...(readStringField(record, "version")
      ? { version: readStringField(record, "version") }
      : {}),
    ...(readStringField(record, "installPath")
      ? { installPath: readStringField(record, "installPath") }
      : {}),
  };
}

/**
 * Parse `claude plugin list --json` output into canonical inventory entries.
 * Missing `enabled` fields are preserved as `unknown`, which health checks
 * treat as not ready for required slash-command plugins.
 */
export function parseClaudePluginListJson(
  output: string
): ClaudePluginInventoryEntry[] {
  const parsed = JSON.parse(output) as unknown;
  const entries = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? (parsed as { installed?: unknown; plugins?: unknown }).installed ??
        (parsed as { plugins?: unknown }).plugins
      : null;
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.flatMap((entry) => {
    const normalized = normalizePluginInventoryEntry(entry);
    return normalized ? [normalized] : [];
  });
}

const TEXT_PLUGIN_ID_REGEX = /([A-Za-z0-9_-]+@closedloop-ai)/;
const TEXT_STATUS_ENABLED_REGEX =
  /Status:\s*(?:(?:✔|✓|\[x\])\s*)?enabled/i;
const TEXT_STATUS_DISABLED_REGEX =
  /Status:\s*(?:(?:✘|x|\[ \])\s*)?disabled/i;

/**
 * Parse human-readable `claude plugin list` output. This is a compatibility
 * fallback for CLI builds where JSON output is unavailable or malformed.
 */
export function parseClaudePluginListText(
  output: string
): ClaudePluginInventoryEntry[] {
  const entries: ClaudePluginInventoryEntry[] = [];
  let current: ClaudePluginInventoryEntry | null = null;

  for (const line of output.split(/\r?\n/)) {
    const idMatch = TEXT_PLUGIN_ID_REGEX.exec(line);
    if (idMatch?.[1]) {
      if (current) {
        entries.push(current);
      }
      current = { id: idMatch[1], enabled: "unknown" };
    }

    if (!current) {
      continue;
    }

    if (TEXT_STATUS_ENABLED_REGEX.test(line)) {
      current.enabled = true;
    } else if (TEXT_STATUS_DISABLED_REGEX.test(line)) {
      current.enabled = false;
    }
  }

  if (current) {
    entries.push(current);
  }

  return entries;
}

/** Convert inventory entries to an ID-keyed map for health-check lookups. */
export function toPluginInventoryMap(
  entries: ClaudePluginInventoryEntry[]
): Map<string, ClaudePluginInventoryEntry> {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

/**
 * Read installed plugin versions from the manifest.
 * Returns a map of "name@closedloop-ai" -> version string.
 */
export function getInstalledPluginVersions(registryPath?: string): Record<string, string> {
  registryPath ??= path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
  try {
    const data = JSON.parse(readFileSync(registryPath, "utf-8")) as InstalledPluginsFile;
    const result: Record<string, string> = {};
    if (!data.plugins) {
      return result;
    }
    for (const [key, entries] of Object.entries(data.plugins)) {
      if (!key.endsWith("@closedloop-ai") || !entries || entries.length === 0) {
        continue;
      }
      const lastEntry = entries.at(-1);
      if (lastEntry?.installPath && existsSync(lastEntry.installPath)) {
        result[key] = lastEntry.version ?? "installed";
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Semver pattern that also accepts pre-release / build metadata suffixes (AC-049 sandbox). */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+([-+][\w.]+)?$/;
const MAX_VERSION_LENGTH = 64;

function isValidSemver(value: string): boolean {
  return value.length <= MAX_VERSION_LENGTH && SEMVER_PATTERN.test(value);
}

/**
 * Return the installed version string for the `code@closedloop-ai` plugin.
 *
 * Resolution order:
 *  1. `CL_PLUGIN_VERSION` environment variable (AC-049 sandbox override).
 *  2. `getInstalledPluginVersions()` registry lookup for `code@closedloop-ai`.
 *
 * The resolved string is validated against a semver pattern and a 64-character
 * maximum length. Returns `'unknown'` on any failure.
 *
 * @param cacheRoot - Optional registry path override (forwarded to
 *   `getInstalledPluginVersions` for testability).
 */
export function getCodePluginVersion(cacheRoot?: string): string {
  try {
    // AC-049 sandbox: allow env-var override for controlled test environments.
    const envVersion = process.env["CL_PLUGIN_VERSION"];
    if (envVersion) {
      return isValidSemver(envVersion) ? envVersion : "unknown";
    }

    const version = getInstalledPluginVersions(cacheRoot)["code@closedloop-ai"];
    if (!version || !isValidSemver(version)) {
      return "unknown";
    }
    return version;
  } catch {
    return "unknown";
  }
}
