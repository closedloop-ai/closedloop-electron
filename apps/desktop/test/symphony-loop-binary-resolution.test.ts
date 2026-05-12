import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  resolveBinaryFromLoginShell,
  resolveBinaryFromLoginShellSync,
  resetShellPathCache,
  type BinaryName,
} from "../src/server/shell-path.js";
import {
  configureBinaryPathsResolver,
  getResolvedClaudePath,
  getResolvedGhPath,
  getResolvedGitPath,
  resetResolvedClaudePath,
} from "../src/server/operations/symphony-loop.js";

const tempDirs: string[] = [];
const originalPath = process.env.PATH;
const originalShell = process.env.SHELL;
const originalShellPathOutput = process.env.CL_TEST_SHELL_PATH_OUTPUT;

afterEach(() => {
  configureBinaryPathsResolver(null);
  resetResolvedClaudePath();
  resetShellPathCache();
  restoreProcessEnv();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function restoreProcessEnv(): void {
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  if (originalShell === undefined) {
    delete process.env.SHELL;
  } else {
    process.env.SHELL = originalShell;
  }
  if (originalShellPathOutput === undefined) {
    delete process.env.CL_TEST_SHELL_PATH_OUTPUT;
  } else {
    process.env.CL_TEST_SHELL_PATH_OUTPUT = originalShellPathOutput;
  }
}

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeFakeBinary(dir: string, name: BinaryName): string {
  const binPath = path.join(dir, name);
  fs.writeFileSync(binPath, `#!/bin/sh\necho ${name}\n`, { mode: 0o755 });
  return binPath;
}

function makeFakeShell(pathOutput: string): string {
  const dir = makeTempDir("symphony-loop-binary-shell-");
  const shellPath = path.join(dir, "fake-shell");
  fs.writeFileSync(
    shellPath,
    [
      "#!/bin/sh",
      "printf '__CLPATH_START__%s__CLPATH_END__\\n' \"$CL_TEST_SHELL_PATH_OUTPUT\"",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  process.env.SHELL = shellPath;
  process.env.CL_TEST_SHELL_PATH_OUTPUT = pathOutput;
  process.env.PATH = makeTempDir("symphony-loop-binary-empty-path-");
  resetShellPathCache();
  return shellPath;
}

function setupFakeLoginShellBinaries(): Record<"claude" | "git" | "gh", string> {
  const binDir = makeTempDir("symphony-loop-binary-bin-");
  const paths = {
    claude: makeFakeBinary(binDir, "claude"),
    git: makeFakeBinary(binDir, "git"),
    gh: makeFakeBinary(binDir, "gh"),
  };
  makeFakeShell(binDir);
  configureBinaryPathsResolver(null);
  resetResolvedClaudePath();
  return paths;
}

describe("symphony-loop binary wrappers", () => {
  test("sync wrappers delegate to the shared login-shell resolver", () => {
    const paths = setupFakeLoginShellBinaries();

    assert.equal(getResolvedClaudePath(), paths.claude);
    assert.equal(getResolvedGitPath(), paths.git);
    assert.equal(getResolvedGhPath(), paths.gh);
    assert.equal(resolveBinaryFromLoginShellSync("claude").path, paths.claude);
    assert.equal(resolveBinaryFromLoginShellSync("git").path, paths.git);
    assert.equal(resolveBinaryFromLoginShellSync("gh").path, paths.gh);
  });

  test("getResolvedClaudePath matches the async resolver path", async () => {
    const paths = setupFakeLoginShellBinaries();

    const syncClaudePath = getResolvedClaudePath();
    const asyncClaude = await resolveBinaryFromLoginShell("claude");

    assert.equal(syncClaudePath, paths.claude);
    assert.equal(asyncClaude.source, "path");
    assert.equal(asyncClaude.path, syncClaudePath);
  });
});
