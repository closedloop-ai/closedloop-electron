import os from "node:os";
import path from "node:path";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { normalizeScopePath } from "../shared/sandbox-policy.js";
import { computeSymphonyDir } from "../server/operations/symphony-utils.js";
import { normalizePath, loadReposConfig, saveReposConfig } from "../server/operations/repos-config-utils.js";

/**
 * Seeds repos.json within the symphony config directory for the given sandbox.
 *
 * - Preserves legacy repos.json from ~/.claude/closedloop/ if dest doesn't exist
 * - Sets worktreeParentDir + worktreeParentDirConfirmed
 * - Discovers git repos in immediate children of sandboxBaseDirectory
 *
 * Best-effort — logs errors but never throws.
 */
export async function seedReposConfig(rawSandboxBaseDirectory: string): Promise<void> {
  try {
    const sandboxBaseDirectory = normalizeScopePath(rawSandboxBaseDirectory);
    if (!sandboxBaseDirectory) {
      return;
    }

    const symphonyDir = computeSymphonyDir(sandboxBaseDirectory);
    const configDir = path.join(symphonyDir, "config");
    mkdirSync(configDir, { recursive: true });

    // Preserve legacy repos.json if it exists and dest doesn't yet.
    // migrateLegacyData() only runs at boot when sandboxBaseDirectory is
    // already set. On first-time onboarding it exits early, so this copy
    // must happen before we seed to avoid blocking future migration.
    const legacyRepos = path.join(os.homedir(), ".claude", "closedloop", "repos.json");
    const destRepos = path.join(configDir, "repos.json");
    if (existsSync(legacyRepos) && !existsSync(destRepos)) {
      copyFileSync(legacyRepos, destRepos);
    }

    // Ensure worktreeParentDir + worktreeParentDirConfirmed are both set.
    // The health check (health-check.ts:176) requires BOTH to be truthy.
    // Rules:
    //   - If worktreeParentDir is missing or outside the sandbox → overwrite
    //     to sandboxBaseDirectory + confirmed. A stale dir outside the sandbox
    //     would fail sandbox policy checks on worktree operations.
    //   - If worktreeParentDir is within the sandbox and confirmed → leave alone
    //     (user may have customised to a subdirectory).
    //   - If worktreeParentDir is within the sandbox but not confirmed →
    //     set confirmed only.
    // Single load → mutate in-memory → single save.
    // Avoids N read/write cycles for sandboxes with many repos.
    const config = await loadReposConfig(configDir);
    let dirty = false;

    const existingDir = config.settings.worktreeParentDir;
    const normalizedExisting = existingDir ? normalizeScopePath(existingDir) : null;
    const isWithinSandbox = normalizedExisting != null && (
      normalizedExisting === sandboxBaseDirectory ||
      normalizedExisting.startsWith(sandboxBaseDirectory + path.sep)
    );

    if (!existingDir || !isWithinSandbox) {
      config.settings = {
        ...config.settings,
        worktreeParentDir: sandboxBaseDirectory,
        worktreeParentDirConfirmed: true
      };
      dirty = true;
    } else if (!config.settings.worktreeParentDirConfirmed) {
      config.settings = { ...config.settings, worktreeParentDirConfirmed: true };
      dirty = true;
    }

    // Discover git repos in immediate children of sandboxBaseDirectory.
    // Skip hidden dirs (starting with ".").
    // Only match real repos (.git is a directory), not worktrees (.git is
    // a file with a gitdir: pointer).
    const knownPaths = new Set(config.repos.map((r) => normalizePath(r.path)));
    const entries = readdirSync(sandboxBaseDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const fullPath = path.join(sandboxBaseDirectory, entry.name);
      const dotGit = path.join(fullPath, ".git");
      try {
        if (!statSync(dotGit).isDirectory()) continue;
      } catch {
        continue; // .git doesn't exist or isn't accessible
      }
      const normalized = normalizePath(fullPath);
      if (knownPaths.has(normalized)) continue;
      knownPaths.add(normalized);
      config.repos.push({
        path: normalized,
        addedAt: new Date().toISOString()
      });
      dirty = true;
    }

    if (dirty) {
      await saveReposConfig(config, configDir);
    }
  } catch (err) {
    // Best-effort — never block onboarding/settings/boot
    console.error("seedReposConfig failed:", err);
  }
}
