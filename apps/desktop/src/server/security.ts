import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class DirectoryNotAllowedError extends Error {
  readonly targetPath: string;

  constructor(targetPath: string) {
    super("directory not allowed");
    this.targetPath = targetPath;
  }
}

export function isPathAllowed(targetPath: string, allowedDirectories: string[]): boolean {
  const resolvedTarget = canonicalizePathForPolicy(targetPath);
  if (isSensitiveDeniedPath(resolvedTarget)) {
    return false;
  }

  for (const allowedDirectory of allowedDirectories) {
    const resolvedAllowedDirectory = canonicalizePathForPolicy(allowedDirectory);
    if (resolvedTarget === resolvedAllowedDirectory) {
      return true;
    }

    const prefix = resolvedAllowedDirectory.endsWith(path.sep)
      ? resolvedAllowedDirectory
      : `${resolvedAllowedDirectory}${path.sep}`;

    if (resolvedTarget.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

export function assertPathAllowed(targetPath: string, allowedDirectories: string[]): void {
  if (!isPathAllowed(targetPath, allowedDirectories)) {
    throw new DirectoryNotAllowedError(targetPath);
  }
}

function canonicalizePathForPolicy(inputPath: string): string {
  const absolutePath = path.resolve(inputPath);
  return resolveWithNearestRealpath(absolutePath);
}

function resolveWithNearestRealpath(absolutePath: string): string {
  try {
    return fs.realpathSync.native(absolutePath);
  } catch {
    const remainder: string[] = [];
    let probe = absolutePath;
    while (true) {
      if (fs.existsSync(probe)) {
        break;
      }
      const parent = path.dirname(probe);
      if (parent === probe) {
        return absolutePath;
      }
      remainder.unshift(path.basename(probe));
      probe = parent;
    }

    try {
      const canonicalBase = fs.realpathSync.native(probe);
      return path.join(canonicalBase, ...remainder);
    } catch {
      return absolutePath;
    }
  }
}

function isSensitiveDeniedPath(resolvedTarget: string): boolean {
  const lowerTarget = resolvedTarget.toLowerCase();
  return SENSITIVE_DENY_PATHS.some((blockedPath) => {
    const canonicalBlocked = canonicalizePathForPolicy(blockedPath);
    const lowerBlocked = canonicalBlocked.toLowerCase();
    return (
      lowerTarget === lowerBlocked ||
      lowerTarget.startsWith(lowerBlocked.endsWith(path.sep) ? lowerBlocked : `${lowerBlocked}${path.sep}`)
    );
  });
}

const SENSITIVE_DENY_PATHS = [
  path.join(os.homedir(), ".ssh"),
  path.join(os.homedir(), ".gnupg"),
  path.join(os.homedir(), ".aws"),
  path.join(os.homedir(), "Library", "Keychains"),
  "/etc",
  "/bin",
  "/sbin"
];
