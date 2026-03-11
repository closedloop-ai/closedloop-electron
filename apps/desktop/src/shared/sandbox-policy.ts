import os from "node:os";
import path from "node:path";

/**
 * Derive the effective allowed-directories list from the sandbox base directory.
 * Returns a single-entry array when sandbox is set, or [] when blank/null/undefined.
 * An empty array means "deny everything" — prevents path.resolve("") from resolving
 * to cwd and silently widening access.
 */
export function buildAllowedDirectories(rawSandbox: string | null | undefined): string[] {
  const sandbox = normalizeScopePath(rawSandbox);
  return sandbox ? [sandbox] : [];
}

/**
 * Normalize a user-provided scope path: trim whitespace, expand ~ to homedir,
 * and resolve to an absolute path. Returns null for blank/null/undefined input.
 */
export function normalizeScopePath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return path.resolve(expandHomePath(trimmed));
}

function expandHomePath(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}
