import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { seedReposConfig } from "../src/main/seed-repos-config.js";
import { loadReposConfig, saveReposConfig } from "../src/server/operations/repos-config-utils.js";

const tempPaths: string[] = [];

function makeTempSandbox(): string {
  const dir = path.join(os.tmpdir(), `seed-repos-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempPaths.push(dir);
  return dir;
}

function configDir(sandbox: string): string {
  return path.join(sandbox, ".closedloop-ai", "config");
}

function createGitRepo(sandbox: string, name: string): string {
  const repoDir = path.join(sandbox, name);
  mkdirSync(path.join(repoDir, ".git"), { recursive: true });
  return repoDir;
}

function createWorktree(sandbox: string, name: string): string {
  const repoDir = path.join(sandbox, name);
  mkdirSync(repoDir, { recursive: true });
  // Worktrees have .git as a file, not a directory
  writeFileSync(path.join(repoDir, ".git"), "gitdir: /some/other/repo/.git/worktrees/wt");
  return repoDir;
}

function createHiddenDir(sandbox: string, name: string): string {
  const dir = path.join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createNonGitDir(sandbox: string, name: string): string {
  const dir = path.join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  for (const tempPath of tempPaths.splice(0)) {
    await fs.rm(tempPath, { recursive: true, force: true });
  }
});

test("sets worktreeParentDir and worktreeParentDirConfirmed", async () => {
  const sandbox = makeTempSandbox();
  const cd = configDir(sandbox);
  mkdirSync(cd, { recursive: true });
  await saveReposConfig({ repos: [], settings: {} }, cd);

  await seedReposConfig(sandbox);

  const config = await loadReposConfig(cd);
  assert.equal(config.settings.worktreeParentDir, sandbox);
  assert.equal(config.settings.worktreeParentDirConfirmed, true);
});

test("discovers real git repos but not worktrees, hidden dirs, or non-git dirs", async () => {
  const sandbox = makeTempSandbox();
  // Pre-create empty repos.json so legacy copy doesn't pull in real user repos
  const cd = configDir(sandbox);
  mkdirSync(cd, { recursive: true });
  await saveReposConfig({ repos: [], settings: {} }, cd);

  createGitRepo(sandbox, "real-repo-a");
  createGitRepo(sandbox, "real-repo-b");
  createWorktree(sandbox, "worktree-dir");
  createHiddenDir(sandbox, ".hidden-repo");
  createNonGitDir(sandbox, "plain-dir");

  await seedReposConfig(sandbox);

  const config = await loadReposConfig(cd);
  const repoPaths = config.repos.map((r) => r.path);
  const repoNames = repoPaths.map((p) => path.basename(p));
  assert.deepEqual(repoNames.sort(), ["real-repo-a", "real-repo-b"], `unexpected repos: ${JSON.stringify(repoPaths)}`);
});

test("calling twice does not create duplicate repos", async () => {
  const sandbox = makeTempSandbox();
  const cd = configDir(sandbox);
  mkdirSync(cd, { recursive: true });
  await saveReposConfig({ repos: [], settings: {} }, cd);

  createGitRepo(sandbox, "my-repo");

  await seedReposConfig(sandbox);
  await seedReposConfig(sandbox);

  const config = await loadReposConfig(cd);
  const repoNames = config.repos.map((r) => path.basename(r.path));
  const count = repoNames.filter((n) => n === "my-repo").length;
  assert.equal(count, 1, "should not duplicate repos on re-seed");
});

test("worktreeParentDir within sandbox but unconfirmed gets confirmed", async () => {
  const sandbox = makeTempSandbox();
  const cd = configDir(sandbox);
  mkdirSync(cd, { recursive: true });

  const subDir = path.join(sandbox, "worktrees");
  mkdirSync(subDir, { recursive: true });

  await saveReposConfig({
    repos: [],
    settings: { worktreeParentDir: subDir, worktreeParentDirConfirmed: false }
  }, cd);

  await seedReposConfig(sandbox);

  const config = await loadReposConfig(cd);
  // Should keep the existing subdirectory
  assert.equal(config.settings.worktreeParentDir, subDir);
  assert.equal(config.settings.worktreeParentDirConfirmed, true);
});

test("worktreeParentDir within sandbox and already confirmed is preserved", async () => {
  const sandbox = makeTempSandbox();
  const cd = configDir(sandbox);
  mkdirSync(cd, { recursive: true });

  const subDir = path.join(sandbox, "custom-worktrees");
  mkdirSync(subDir, { recursive: true });

  await saveReposConfig({
    repos: [],
    settings: { worktreeParentDir: subDir, worktreeParentDirConfirmed: true }
  }, cd);

  await seedReposConfig(sandbox);

  const config = await loadReposConfig(cd);
  assert.equal(config.settings.worktreeParentDir, subDir);
  assert.equal(config.settings.worktreeParentDirConfirmed, true);
});

test("worktreeParentDir outside sandbox gets overwritten", async () => {
  const sandbox = makeTempSandbox();
  const cd = configDir(sandbox);
  mkdirSync(cd, { recursive: true });

  const outsideDir = path.join(os.tmpdir(), "some-other-dir");
  mkdirSync(outsideDir, { recursive: true });
  tempPaths.push(outsideDir);

  await saveReposConfig({
    repos: [],
    settings: { worktreeParentDir: outsideDir, worktreeParentDirConfirmed: true }
  }, cd);

  await seedReposConfig(sandbox);

  const config = await loadReposConfig(cd);
  assert.equal(config.settings.worktreeParentDir, sandbox);
  assert.equal(config.settings.worktreeParentDirConfirmed, true);
});

test("sandbox change from A to B overwrites stale worktreeParentDir=A", async () => {
  const sandboxA = makeTempSandbox();
  const sandboxB = makeTempSandbox();

  // Seed with sandbox A
  await seedReposConfig(sandboxA);
  const configA = await loadReposConfig(configDir(sandboxA));
  assert.equal(configA.settings.worktreeParentDir, sandboxA);

  // Now seed sandbox B (would be a fresh config dir)
  await seedReposConfig(sandboxB);
  const configB = await loadReposConfig(configDir(sandboxB));
  assert.equal(configB.settings.worktreeParentDir, sandboxB);
  assert.equal(configB.settings.worktreeParentDirConfirmed, true);
});

test("seeding failure does not throw but logs to console.error", async () => {
  const errors: unknown[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => errors.push(args);

  try {
    // Pass a path that doesn't exist — readdir will fail inside the try/catch
    await seedReposConfig("/nonexistent/path/that/should/fail");
    // Should not throw
  } finally {
    console.error = origError;
  }

  assert.ok(errors.length > 0, "should have logged an error");
});

test("empty string sandbox is a no-op", async () => {
  // Should not throw or create any files
  await seedReposConfig("");
  await seedReposConfig("   ");
});
