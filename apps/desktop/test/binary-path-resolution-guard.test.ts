import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(testDir, "..");
const srcRoot = path.join(desktopRoot, "src");
const legacyResolverName = ["resolveBinaryFrom", "InheritedPath"].join("");

type ScannedFile = {
  absolutePath: string;
  relativePath: string;
  text: string;
};

function collectTypeScriptFiles(dir: string): ScannedFile[] {
  const files: ScannedFile[] = [];
  for (const entry of readdirSync(dir)) {
    const absolutePath = path.join(dir, entry);
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      files.push(...collectTypeScriptFiles(absolutePath));
      continue;
    }
    if (!entry.endsWith(".ts")) {
      continue;
    }
    files.push({
      absolutePath,
      relativePath: path.relative(desktopRoot, absolutePath),
      text: readFileSync(absolutePath, "utf8"),
    });
  }
  return files;
}

function readScannedFile(relativePath: string): ScannedFile {
  const absolutePath = path.join(desktopRoot, relativePath);
  return {
    absolutePath,
    relativePath,
    text: readFileSync(absolutePath, "utf8"),
  };
}

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function collectRegexViolations(
  files: ScannedFile[],
  label: string,
  pattern: RegExp,
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const match of file.text.matchAll(pattern)) {
      violations.push(`${file.relativePath}:${lineNumber(file.text, match.index ?? 0)} ${label}`);
    }
  }
  return violations;
}

describe("binary path resolution source guards", () => {
  test("desktop source does not use direct host discovery commands", () => {
    const sourceFiles = collectTypeScriptFiles(srcRoot);
    const violations = [
      ...collectRegexViolations(
        sourceFiles,
        "uses execFileSync with direct binary discovery",
        /\bexecFileSync\s*\(\s*["']which["']/g,
      ),
      ...collectRegexViolations(
        sourceFiles,
        "uses execSync with direct binary discovery",
        /\bexecSync\s*\(\s*["']which\b[^"']*["']/g,
      ),
      ...collectRegexViolations(
        sourceFiles,
        "uses bash -lc with direct binary discovery",
        /\b(?:execFileSync|execFile|spawn|spawnSync)\s*\(\s*["']bash["']\s*,\s*\[[^\]]*["']-lc["'][^\]]*\bwhich\b[^\]]*\]/g,
      ),
    ];

    assert.deepEqual(
      violations,
      [],
      `Use resolveBinaryFromLoginShell or resolveBinaryFromLoginShellSync instead:\n${violations.join("\n")}`,
    );
  });

  test("desktop source only declares approved getResolvedXxxPath wrappers", () => {
    const allowed = new Set([
      "getResolvedClaudePath",
      "getResolvedGitPath",
      "getResolvedGhPath",
    ]);
    const sourceFiles = collectTypeScriptFiles(srcRoot);
    const declarations: string[] = [];

    for (const file of sourceFiles) {
      for (const match of file.text.matchAll(
        /\b(?:export\s+)?function\s+(getResolved[A-Z][A-Za-z0-9]*Path)\s*\(/g,
      )) {
        const helperName = match[1];
        if (!allowed.has(helperName)) {
          declarations.push(`${file.relativePath}:${lineNumber(file.text, match.index ?? 0)} ${helperName}`);
        }
      }
    }

    assert.deepEqual(declarations, [], `Unapproved resolver wrappers found:\n${declarations.join("\n")}`);
  });

  test("legacy inherited PATH resolver references stay deleted", () => {
    const legacyPattern = new RegExp(`\\b${legacyResolverName}\\b`, "g");
    const files = [
      ...collectTypeScriptFiles(srcRoot),
      readScannedFile("test/resolve-binary.test.ts"),
      readScannedFile("test/symphony-loop-binary-resolution.test.ts"),
    ];
    const violations = collectRegexViolations(
      files,
      "references deleted inherited PATH resolver",
      legacyPattern,
    );

    assert.deepEqual(violations, [], `Legacy resolver references found:\n${violations.join("\n")}`);
  });
});
