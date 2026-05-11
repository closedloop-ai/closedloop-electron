import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { isGitRepository } from "../src/shared/git-utils.js";

// Unit tests for the .git detection logic used by the
// `desktop:pick-sandbox-directory` IPC handler in app.ts.
//
// The handler returns:
//   { path, isGitRepo: true,  suggestedPath: parent }  when selectedPath/.git exists
//   { path, isGitRepo: false, suggestedPath: undefined } otherwise

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

async function makeTempDir(suffix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `pick-sandbox-${suffix}-`));
  tempDirs.push(dir);
  return dir;
}

describe("isGitRepository — .git detection logic for desktop:pick-sandbox-directory", () => {
  test("returns true when selected directory contains a .git subdirectory", async () => {
    const selectedPath = await makeTempDir("with-git");
    await fs.mkdir(path.join(selectedPath, ".git"));

    const isGitRepo = isGitRepository(selectedPath);
    assert.equal(isGitRepo, true);

    // Replicate the handler logic: suggestedPath is the parent directory
    const suggestedPath = isGitRepo ? path.dirname(selectedPath) : undefined;
    assert.equal(suggestedPath, path.dirname(selectedPath));
  });

  test("returns false when selected directory does NOT contain a .git subdirectory", async () => {
    const selectedPath = await makeTempDir("no-git");

    const isGitRepo = isGitRepository(selectedPath);
    assert.equal(isGitRepo, false);

    // Replicate the handler logic: suggestedPath is undefined
    const suggestedPath = isGitRepo ? path.dirname(selectedPath) : undefined;
    assert.equal(suggestedPath, undefined);
  });

  test("returns true when .git is a file (e.g. git worktree)", async () => {
    const selectedPath = await makeTempDir("git-file");
    // git worktrees use a `.git` file pointing elsewhere; existsSync is true
    // for files too — this test documents that our detection is path-existence
    // based (matches the IPC handler behaviour).
    await fs.writeFile(path.join(selectedPath, ".git"), "gitdir: /other/.git\n");

    const isGitRepo = isGitRepository(selectedPath);
    // .git exists as a file → existsSync returns true → treated as a git repo
    assert.equal(isGitRepo, true);
  });
});
