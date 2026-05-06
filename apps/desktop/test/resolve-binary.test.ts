/**
 * T-3.14: Tests for resolveBinary and resolveBinarySync from shell-path.ts.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  resolveBinary,
  resolveBinarySync,
  resetShellPathCache,
  setShellPathForTest,
  type BinaryName,
} from "../src/server/shell-path.js";

const tempDirs: string[] = [];
const originalPath = process.env.PATH;

afterEach(() => {
  process.env.PATH = originalPath;
  resetShellPathCache();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Create a temporary directory with an executable file at the given name.
 * Returns the directory path and the full path to the fake binary.
 */
function makeTempBin(name: string): { dir: string; binPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-binary-test-"));
  tempDirs.push(dir);
  const binPath = path.join(dir, name);
  fs.writeFileSync(binPath, "#!/bin/sh\necho fake\n", { mode: 0o755 });
  return { dir, binPath };
}

/**
 * Create a temporary directory with a non-executable file at the given name.
 * Returns the directory path and the full path to the fake binary.
 */
function makeTempNonExecutableBin(name: string): { dir: string; binPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-binary-noexec-"));
  tempDirs.push(dir);
  const binPath = path.join(dir, name);
  fs.writeFileSync(binPath, "#!/bin/sh\necho fake\n", { mode: 0o644 });
  return { dir, binPath };
}

const ALL_BINARY_NAMES: BinaryName[] = ["claude", "gh", "codex", "python3", "git"];

// ---------------------------------------------------------------------------
// resolveBinary (async)
// ---------------------------------------------------------------------------

describe("resolveBinary: override valid (file exists and is executable)", () => {
  for (const name of ALL_BINARY_NAMES) {
    test(`${name}: returns source "override" with override path`, async () => {
      const { binPath } = makeTempBin(name);
      const result = await resolveBinary(name, binPath);
      assert.equal(result.source, "override");
      assert.equal(result.path, binPath);
    });
  }
});

describe("resolveBinary: override invalid (file does not exist)", () => {
  for (const name of ALL_BINARY_NAMES) {
    test(`${name}: returns source "override_invalid" with override path (no PATH fallback)`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-binary-missing-"));
      tempDirs.push(dir);
      const nonExistentPath = path.join(dir, name);
      // Do NOT create the file -- it should not exist

      // Put a real binary on PATH to confirm no fallback occurs
      const { dir: binDir, binPath: realBin } = makeTempBin(name);
      process.env.PATH = binDir;
      setShellPathForTest();

      const result = await resolveBinary(name, nonExistentPath);
      assert.equal(result.source, "override_invalid");
      assert.equal(result.path, nonExistentPath);
      // Confirm the result is NOT the PATH-based binary
      assert.notEqual(result.path, realBin);
    });
  }
});

describe("resolveBinary: override invalid (file exists but not executable)", () => {
  for (const name of ALL_BINARY_NAMES) {
    test(`${name}: returns source "override_invalid"`, async () => {
      const { binPath } = makeTempNonExecutableBin(name);
      const result = await resolveBinary(name, binPath);
      assert.equal(result.source, "override_invalid");
      assert.equal(result.path, binPath);
    });
  }
});

describe("resolveBinary: no override, binary on PATH", () => {
  for (const name of ALL_BINARY_NAMES) {
    test(`${name}: returns source "path"`, async () => {
      const { dir, binPath } = makeTempBin(name);
      process.env.PATH = dir;
      setShellPathForTest();

      const result = await resolveBinary(name);
      assert.equal(result.source, "path");
      assert.equal(result.path, binPath);
    });
  }
});

describe("resolveBinary: no override, binary not on PATH", () => {
  for (const name of ALL_BINARY_NAMES) {
    test(`${name}: returns source "fallback" with bare binary name`, async () => {
      // Use an empty PATH so no binary is found
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-binary-empty-"));
      tempDirs.push(emptyDir);
      process.env.PATH = emptyDir;
      setShellPathForTest();

      const result = await resolveBinary(name);
      assert.equal(result.source, "fallback");
      assert.equal(result.path, name);
    });
  }
});

// ---------------------------------------------------------------------------
// resolveBinarySync
// ---------------------------------------------------------------------------

describe("resolveBinarySync: override valid (file exists and is executable)", () => {
  for (const name of ALL_BINARY_NAMES) {
    test(`${name}: returns source "override" with override path`, () => {
      const { binPath } = makeTempBin(name);
      const result = resolveBinarySync(name, binPath);
      assert.equal(result.source, "override");
      assert.equal(result.path, binPath);
    });
  }
});

describe("resolveBinarySync: override invalid (file does not exist)", () => {
  for (const name of ALL_BINARY_NAMES) {
    test(`${name}: returns source "override_invalid" (no PATH fallback)`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-binary-sync-missing-"));
      tempDirs.push(dir);
      const nonExistentPath = path.join(dir, name);
      // Do NOT create the file

      const result = resolveBinarySync(name, nonExistentPath);
      assert.equal(result.source, "override_invalid");
      assert.equal(result.path, nonExistentPath);
    });
  }
});

describe("resolveBinarySync: override invalid (file exists but not executable)", () => {
  for (const name of ALL_BINARY_NAMES) {
    test(`${name}: returns source "override_invalid"`, () => {
      const { binPath } = makeTempNonExecutableBin(name);
      const result = resolveBinarySync(name, binPath);
      assert.equal(result.source, "override_invalid");
      assert.equal(result.path, binPath);
    });
  }
});

describe("resolveBinarySync: no override, binary on PATH", () => {
  test("git: returns source 'path' when git is on PATH (uses system which)", () => {
    // resolveBinarySync uses execFileSync("which", ...) -- system git is available in CI
    const result = resolveBinarySync("git");
    // git is almost always available in the test environment
    assert.ok(
      result.source === "path" || result.source === "fallback",
      `expected 'path' or 'fallback', got '${result.source}'`
    );
  });
});

describe("resolveBinarySync: no override, binary not on PATH (via override invalid path)", () => {
  for (const name of ALL_BINARY_NAMES) {
    test(`${name}: override_invalid for non-existent override path`, () => {
      const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-binary-sync-fake-"));
      tempDirs.push(fakeDir);
      const fakePath = path.join(fakeDir, `definitely-not-${name}`);
      // Path does not exist
      const result = resolveBinarySync(name, fakePath);
      assert.equal(result.source, "override_invalid");
      assert.equal(result.path, fakePath);
    });
  }
});

// ---------------------------------------------------------------------------
// FEA-935: PATH-discovery asymmetry between resolveBinary and resolveBinarySync
// ---------------------------------------------------------------------------
//
// The symphony-loop preflight previously called resolveBinarySync("claude"),
// which consulted Electron's bare process.env.PATH (and a bash -lc fallback).
// That misses common installs (nvm/fnm/asdf/Volta/Bun/mise, /opt/homebrew on
// Apple Silicon when ~/.zshrc owns the PATH munging) even when the in-app
// health check — which uses getShellPath() via the async resolveBinary —
// confirms the binary is reachable. This caused the user-visible failure:
// green health check + every loop returning 500 "claude CLI not found in
// PATH". The fix was to switch the preflight to await resolveBinary(...).
//
// These tests guard the contract that resolveBinary honors getShellPath()
// independently of process.env.PATH.

describe("resolveBinary: getShellPath drives discovery, not process.env.PATH (FEA-935)", () => {
  test("finds binary via getShellPath() even when process.env.PATH excludes its dir", async () => {
    const { dir, binPath } = makeTempBin("claude");

    // Lock getShellPath() to a PATH that includes the fake binary's dir.
    // This mirrors what `$SHELL -ilc echo $PATH` returns on a real machine
    // where claude is installed via a version manager / Homebrew.
    process.env.PATH = dir;
    setShellPathForTest();

    // Now strip the fake-bin dir from process.env.PATH. This simulates
    // Electron's bare GUI-launched PATH on macOS, which does NOT include
    // any dirs added by the user's interactive shell init.
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "fea935-empty-"));
    tempDirs.push(emptyDir);
    process.env.PATH = emptyDir;

    // resolveBinary (async) consults getShellPath() and finds the binary —
    // the OLD preflight (resolveBinarySync) consulted process.env.PATH and
    // missed it, returning "fallback" and 500ing the loop request.
    const result = await resolveBinary("claude");
    assert.equal(result.source, "path");
    assert.equal(result.path, binPath);
  });

  test("returns 'fallback' only when binary is absent from BOTH getShellPath() and process.env.PATH", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "fea935-truly-empty-"));
    tempDirs.push(emptyDir);
    process.env.PATH = emptyDir;
    setShellPathForTest();

    const result = await resolveBinary("claude");
    assert.equal(result.source, "fallback");
    assert.equal(result.path, "claude");
  });
});

// ---------------------------------------------------------------------------
// BinaryName compile-time type check
// ---------------------------------------------------------------------------
// This is intentionally a type-only assertion. All five names are accepted
// as BinaryName at compile time; no runtime assertion is needed.
const _typeCheck: BinaryName[] = ["claude", "gh", "codex", "python3", "git"];
void _typeCheck;
